import logger from '../../lib/logger';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import NativeBrowser from './modes/NativeBrowser';
import LocalWhisper from './modes/LocalWhisper';
import { createMicStream } from './utils/audioUtils';

export default class TranscriptionService {
  constructor({ onTranscriptUpdate, onModelLoadProgress, onReady, profile, forceCloud = false, forceOnDevice = false, forceNative = false, session, navigate, getAssemblyAIToken } = {}) {
    logger.info({ forceCloud, forceOnDevice, forceNative }, `[TranscriptionService] Constructor called`);
    this.mode = null;
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
    this.instance = null;
    this.mic = null;
  }

  async init() {
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

  async startTranscription() {
    logger.info('[TranscriptionService] Attempting to start transcription...');
    if (!this.mic) {
      throw new Error("Microphone not initialized. Call init() first.");
    }

    const providerConfig = {
      onTranscriptUpdate: this.onTranscriptUpdate,
      onModelLoadProgress: this.onModelLoadProgress,
      onReady: this.onReady,
      session: this.session,
      navigate: this.navigate,
      getAssemblyAIToken: this.getAssemblyAIToken,
    };

    if (this.forceNative) {
        logger.info('[TranscriptionService] Dev Toggle: Forcing Native Browser mode.');
        try {
            this.instance = new NativeBrowser(providerConfig);
            await this.instance.init();
            await this.instance.startTranscription(this.mic);
            this.mode = 'native';
            return;
        } catch (e) {
            logger.error({ e }, '[TranscriptionService] Forced native mode failed.');
            throw e;
        }
    }

    if (this.forceOnDevice) {
        logger.info('[TranscriptionService] Dev Toggle: Forcing On-Device mode.');
    }

    // --- Provider Selection Logic ---
    const isPro = this.profile && this.profile.subscription_status === 'pro';

    // The user can prefer on-device, or we can force it with a dev toggle.
    const useOnDevice = this.forceOnDevice || (isPro && this.profile.preferred_mode === 'on-device');

    if (useOnDevice) {
      logger.info('[TranscriptionService] Attempting to use On-Device (LocalWhisper) mode.');
      this.instance = new LocalWhisper(providerConfig);
      await this.instance.init();
      await this.instance.startTranscription(this.mic);
      this.mode = 'on-device';
      return;
    }

    // Pro users without a preference for on-device will use the cloud mode.
    // We can also force it with a dev toggle.
    const useCloud = this.forceCloud || isPro;
    logger.info({ useCloud }, `[TranscriptionService] Decided on cloud mode`);

    if (useCloud) {
      logger.info('[TranscriptionService] Calling getAssemblyAIToken...');
      const token = await this.getAssemblyAIToken();
      if (token) {
        logger.info('[TranscriptionService] Token acquired, starting CloudAssemblyAI.');
        this.instance = new CloudAssemblyAI(providerConfig);
        await this.instance.init();
        await this.instance.startTranscription(this.mic);
        this.mode = 'cloud';
        return;
      } else {
        logger.warn('[TranscriptionService] Failed to get AssemblyAI token.');
        if (this.forceCloud) {
          logger.error('[TranscriptionService] forceCloud is enabled, throwing error without fallback.');
          throw new Error('Failed to get AssemblyAI token in forceCloud mode.');
        }
        logger.warn('[TranscriptionService] Proceeding with native fallback.');
      }
    }

    // Fallback for free users or if cloud fails for a pro user without forceCloud.
    try {
      logger.info('[TranscriptionService] Starting Native Browser mode.');
      this.instance = new NativeBrowser(providerConfig);
      await this.instance.init();
      await this.instance.startTranscription(this.mic);
      this.mode = 'native';
    } catch (fallbackError) {
      logger.error({ fallbackError }, '[TranscriptionService] Native mode failed.');
      throw fallbackError;
    }
  }

  async stopTranscription() {
    logger.info('[TranscriptionService] Stopping transcription.');
    if (!this.instance) {
      logger.warn('[TranscriptionService] No instance to stop.');
      return '';
    }
    const result = await this.instance.stopTranscription();
    logger.info('[TranscriptionService] Transcription stopped.');
    return result;
  }

  async getTranscript() {
    if (!this.instance) return '';
    return this.instance.getTranscript();
  }

  async destroy() {
    logger.info('[TranscriptionService] Destroying service.');
    try { await this.stopTranscription(); } catch { /* best effort */ }
    try {
      if (this.mic) {
        this.mic.stop();
        logger.info('[TranscriptionService] Mic stream stopped.');
      }
    } catch { /* best effort */ }
    this.instance = null;
    this.mic = null;
    logger.info('[TranscriptionService] Service destroyed.');
  }
}
