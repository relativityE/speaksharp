import logger from '../../lib/logger';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import NativeBrowser from './modes/NativeBrowser';
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

    // Dev override for native
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

    // Dev override for on-device
    if (this.forceOnDevice) {
        logger.info('[TranscriptionService] Dev Toggle: Forcing On-Device mode. NOTE: Not yet implemented.');
        // In the future, this would instantiate the LocalWhisper model.
        // For now, we will fall through to native as a placeholder.
    }

    const useCloud = this.forceCloud || (this.profile && (this.profile.subscription_status === 'pro' || this.profile.subscription_status === 'premium'));
    logger.info({ useCloud }, `[TranscriptionService] Decided on cloud mode`);

    if (useCloud && !this.forceOnDevice) { // Do not use cloud if forcing on-device
      logger.info('[TranscriptionService] Calling getAssemblyAIToken...');
      const token = await this.getAssemblyAIToken();
      logger.info(`[TranscriptionService] getAssemblyAIToken returned: ${token ? 'a token' : 'null'}`);
      if (token) {
        logger.info('[TranscriptionService] Token acquired, starting CloudAssemblyAI.');
        this.instance = new CloudAssemblyAI(providerConfig);
        await this.instance.init();
        await this.instance.startTranscription(this.mic);
        this.mode = 'cloud';
        logger.info('[TranscriptionService] Cloud transcription started successfully.');
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

    // Fallback to native if not using cloud or if token fetch failed
    try {
      logger.info('[TranscriptionService] Starting Native Browser mode.');
      this.instance = new NativeBrowser(providerConfig);
      await this.instance.init();
      await this.instance.startTranscription(this.mic);
      this.mode = 'native';
      logger.info('[TranscriptionService] Native transcription started successfully.');
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
    try { await this.stopTranscription(); } catch (e) { /* best effort */ }
    try {
      if (this.mic) {
        this.mic.stop();
        logger.info('[TranscriptionService] Mic stream stopped.');
      }
    } catch (e) { /* best effort */ }
    this.instance = null;
    this.mic = null;
    logger.info('[TranscriptionService] Service destroyed.');
  }
}
