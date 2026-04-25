import logger from '../../../lib/logger';
import { ITranscriptionEngine, TranscriptionModeOptions, Transcript, Result } from './types';
import { TranscriptionError } from '../errors';
import { IPrivateSTTEngine, EngineType } from '../../../contracts/IPrivateSTTEngine';
import { MicStream } from '../utils/types';
import { STTEngine } from '../../../contracts/STTEngine';
import { ENV } from '../../../config/TestFlags';

// A simplified interface for the SpeechRecognition event
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    isFinal: boolean;
    [key: number]: {
      transcript: string;
    };
  }[];
}

// A simplified interface for the SpeechRecognition error event
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

// Define a type for the SpeechRecognition API to avoid using 'any'
interface SpeechRecognition {
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionStatic {
  new(): SpeechRecognition;
}

/**
 * NativeBrowser implementation of the STTEngine abstract base class.
 * Leverages the browser's built-in SpeechRecognition API.
 */
export default class NativeBrowser extends STTEngine implements ITranscriptionEngine {
  public readonly type: EngineType = 'native-browser';
  private mockEngine?: IPrivateSTTEngine;
  private recognition: SpeechRecognition | null = null;
  private isSupported: boolean = true;
  private isListening: boolean = false;
  private isRestarting: boolean = false;
  public onTranscriptUpdate?: (update: { transcript: Transcript }) => void;
  public onReady?: () => void;
  public onError?: (error: TranscriptionError) => void;
  private _engineType: EngineType | null = null;

  constructor(options: Partial<TranscriptionModeOptions> = {}, mockEngine?: IPrivateSTTEngine) {
    super(options as TranscriptionModeOptions);
    this.mockEngine = mockEngine;
    
    this.onTranscriptUpdate = options.onTranscriptUpdate;
    this.onReady = options.onReady;
    this.onError = options.onError;
  }

  private get modeOptions(): TranscriptionModeOptions | null {
    return this.options as TranscriptionModeOptions;
  }

  /**
   * STTStrategy Requirement: Probe availability and prerequisites.
   */
  public async checkAvailability(): Promise<import('../STTStrategy').AvailabilityResult> {
    // Mock engine injected = availability is authoritatively declared by test harness
    if (this.mockEngine) {
      return { isAvailable: true };
    }

    // 1. Check for basic browser support
    const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition) as SpeechRecognitionStatic;
    if (!SpeechRecognition) {
      return {
        isAvailable: false,
        reason: 'UNSUPPORTED',
        message: 'This browser does not support the Web Speech API. Please try Chrome or Safari.'
      };
    }

    // 2. Check for microphone permission if API is available
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (result.state === 'denied') {
          return {
            isAvailable: false,
            reason: 'PERMISSION_DENIED',
            message: 'Microphone access is denied. Please grant permission in your browser settings.'
          };
        }
      } catch (err) {
        logger.warn({ err }, '[NativeBrowser] Permission query failed.');
      }
    }

    return { isAvailable: true };
  }


  protected override async onInit(timeoutMs?: number): Promise<Result<void, Error>> {
    // Use injected mock if available
    if (this.mockEngine) {
        logger.info('[NativeBrowser] 🧪 Using injected MockEngine');
        if (this.mockEngine.init) {
            await this.mockEngine.init(timeoutMs);
        }
        return Result.ok(undefined);
    }

    if (typeof window === 'undefined') return Result.ok(undefined);
    const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition) as SpeechRecognitionStatic;
    this.isSupported = !!SpeechRecognition;

    if (!this.isSupported) {
      logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Native browser speech recognition not supported');
      return Result.err(new Error('Native browser speech recognition not supported'));
    }

    this.recognition = new SpeechRecognition();
    this.recognition.interimResults = true;
    this.recognition.continuous = true;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      try {
        this.updateHeartbeat();
        logger.info({ sId: this.serviceId, rId: this.runId, resultIndex: event.resultIndex, resultsLength: event.results?.length }, '[NativeBrowser] onresult called!');
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
            logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, finalTranscript }, '[NativeBrowser] Final transcript received');
          } else {
            interimTranscript += event.results[i][0].transcript;
            logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, interimTranscript }, '[NativeBrowser] Interim transcript received');
          }
        }

        if (this.onTranscriptUpdate) {
          if (interimTranscript) {
            this.onTranscriptUpdate({ transcript: { partial: interimTranscript } });
          }
          if (finalTranscript) {
            this.currentTranscript += finalTranscript;
            this.onTranscriptUpdate({ transcript: { final: finalTranscript } });
          }
        }
      } catch (error) {
        logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, error }, "Error in NativeBrowser onresult handler:");
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      try {
        logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, error: event.error }, `[NativeBrowser] Speech recognition error: ${event.error}`);

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Microphone permission denied by user or browser settings');
          if (this.onError) {
            this.onError(TranscriptionError.permission('Microphone permission denied. Please allow microphone access in your browser/system settings.'));
          }
        }
      } catch (error) {
        logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, error }, "Error in NativeBrowser onerror handler:");
      }
    };

    this.recognition.onend = () => {
      if (!this.isListening || this.isRestarting) return;

      try {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] onend reached, attempting immediate restart...');
        this.isRestarting = true;

        queueMicrotask(() => {
          if (this.isListening && this.recognition) {
            try {
              this.recognition.start();
              this.isRestarting = false;
            } catch (err) {
              logger.warn({ err }, "[NativeBrowser] Immediate restart failed, using backoff");
              this.retryWithBackoff(0);
            }
          } else {
            this.isRestarting = false;
          }
        });
      } catch (error) {
        logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, error }, "Error in NativeBrowser onend handler:");
        this.isRestarting = false;
      }
    };

    this.recognition.onstart = () => {
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Recognition started');
      this.isListening = true;
      this.updateHeartbeat();
      if (this.modeOptions?.onReady) this.modeOptions.onReady();
    };

    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Init complete.');

    return Result.ok(undefined);
  }

  protected async onStart(_mic?: MicStream): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] start called');
    
    if (this.mockEngine) {
        logger.info('[NativeBrowser] 🧪 Using injected MockEngine');
        if (this.mockEngine.start) await this.mockEngine.start(_mic);
        this.isListening = true;
        this.currentTranscript = '';
        return;
    }

    if (!this.recognition) {
      throw new Error('NativeBrowser not initialized');
    }
    if (this.isListening) {
      logger.warn({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Already listening, returning early');
      return;
    }
    this.currentTranscript = '';
    this.isListening = true;
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Starting recognition.start()...');
    this.recognition.start();

    // E2E Test Bridge (Strict Zero)
    interface E2EWindow extends Window {
      dispatchMockTranscript?: unknown;
      __activeSpeechRecognition?: SpeechRecognition;
    }
    const win = window as unknown as E2EWindow;

    if (ENV.isE2E || win.dispatchMockTranscript) {
      win.__activeSpeechRecognition = this.recognition;
      (win as unknown as Record<string, boolean>)['__e2e_e2e:speech-recognition-ready_fired__'] = true;
      window.dispatchEvent(new CustomEvent('e2e:speech-recognition-ready'));
    }

    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] recognition.start() called successfully.');
  }

  protected async onStop(): Promise<void> {
    if (this.isTerminated) return;
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Finalizing transcription shutdown');
    
    if (this.mockEngine) {
      if (this.mockEngine.stop) await this.mockEngine.stop();
      this.isListening = false;
      return;
    }

    if (!this.recognition || !this.isListening) {
      this.isListening = false;
      this.isRestarting = false;
      return;
    }

    this.isListening = false;
    this.isRestarting = false;
    this.updateHeartbeat();

    // DETERMINISTIC SHUTDOWN: Await the 'onend' event
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('[NativeBrowser] SpeechRecognition stop timed out. Resolving.');
        resolve();
      }, 1000); // 1s safety timeout

      if (this.recognition) {
        const originalOnEnd = this.recognition.onend;
        this.recognition.onend = () => {
          if (originalOnEnd) originalOnEnd();
          clearTimeout(timeout);
          resolve();
        };
        try {
          this.recognition.stop();
        } catch (err) {
          logger.warn({ err }, '[NativeBrowser] Error in recognition.stop()');
          resolve();
        }
      } else {
        resolve();
      }
    });

    this.recognition = null; // Clear to prevent reuse
  }

  public async pause(): Promise<void> {
    await super.pause();
  }

  protected async onPause(): Promise<void> {
    // Native browser handles audio internally; no-op for pause loop
  }

  public async resume(): Promise<void> {
    await super.resume();
  }

  protected async onResume(): Promise<void> {
    // Native browser handles audio internally; no-op for resume loop
  }

  protected async onDestroy(): Promise<void> {
    // Already handled in onStop via destroy() calling stop()
  }

  public async terminate(): Promise<void> {
    if (this.isTerminated) return;
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] 🛑 Nuclear termination requested');
    
    if (this.mockEngine) {
      if (typeof this.mockEngine.terminate === 'function') await this.mockEngine.terminate();
      else await this.mockEngine.destroy();
    }
    
    await this.onStop();
    await super.terminate();
  }

  public override async getTranscript(): Promise<string> {
    const engineWithGet = this.mockEngine as unknown as { getTranscript?: () => Promise<string> };
    if (engineWithGet && engineWithGet.getTranscript) {
        return engineWithGet.getTranscript();
    }
    return super.getTranscript();
  }

  public getLastHeartbeatTimestamp(): number {
    return this.mockEngine ? this.mockEngine.getLastHeartbeatTimestamp() : super.getLastHeartbeatTimestamp();
  }

  async transcribe(_audio: Float32Array): Promise<Result<string, Error>> {
    // Native browser handles audio internally.
    this.updateHeartbeat();
    return Result.ok(this.currentTranscript);
  }

  /** @internal */
  public override updateHeartbeat(): void {
    this.lastHeartbeat = Date.now();
  }

  private retryWithBackoff(attempt: number): void {
    const MAX_ATTEMPTS = 3;
    const BASE_DELAY_MS = 100;

    if (attempt >= MAX_ATTEMPTS) {
      logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Max restart attempts reached, giving up');
      this.isRestarting = false;
      this.onError?.(TranscriptionError.unknown('Speech recognition restart failed after multiple attempts'));
      return;
    }

    const delay = BASE_DELAY_MS * Math.pow(2, attempt);
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, attempt, delay }, '[NativeBrowser] Scheduling retry with backoff');

    setTimeout(() => {
      if (!this.isListening || !this.recognition) {
        this.isRestarting = false;
        return;
      }

      try {
        this.recognition.start();
        this.isRestarting = false;
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, attempt }, '[NativeBrowser] Restart succeeded after backoff');
      } catch (err) {
        logger.warn({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, err, attempt }, '[NativeBrowser] Backoff retry failed, trying next attempt');
        this.retryWithBackoff(attempt + 1);
      }
    }, delay);
  }
}
