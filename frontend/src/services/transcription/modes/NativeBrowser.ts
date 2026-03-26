import logger from '@/lib/logger';
import { ITranscriptionEngine, TranscriptionModeOptions, Transcript, TranscriptionError, Result } from './types';
import { MicStream } from '../utils/types';
import { STTEngine } from '@/contracts/STTEngine';
import { EngineType, EngineCallbacks } from '@/contracts/IPrivateSTTEngine';
import { ENV } from '@/config/TestFlags';

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
  public readonly type: EngineType = 'native';
  private recognition: SpeechRecognition | null = null;
  private isSupported: boolean = true;
  private isListening: boolean = false;
  private isRestarting: boolean = false;
  protected lastHeartbeat: number = Date.now();

  private onTranscriptUpdate?: (update: { transcript: Transcript }) => void;
  private onEngineError?: (error: TranscriptionError) => void;

  constructor(_options?: TranscriptionModeOptions) {
    super();
  }

  protected async onInit(callbacks: EngineCallbacks | TranscriptionModeOptions): Promise<Result<void, Error>> {
    const options = callbacks as TranscriptionModeOptions;
    this.onTranscriptUpdate = options.onTranscriptUpdate;
    this.onEngineError = options.onError;

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
          if (this.onEngineError) {
            this.onEngineError(TranscriptionError.permission('Microphone permission denied. Please allow microphone access in your browser/system settings.'));
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
      if (options.onReady) options.onReady();
    };

    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Init complete.');

    return Result.ok(undefined);
  }

  protected async onStart(_mic?: MicStream): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] start called');
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
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] stopTranscription called');
    if (!this.recognition || !this.isListening) {
      logger.warn({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Not listening or recognition not initialized');
      return;
    }
    this.isListening = false;
    this.updateHeartbeat();
    this.recognition.stop();
  }

  protected async onDestroy(): Promise<void> {
    // Already handled in onStop via destroy() calling stop()
  }

  async transcribe(_audio: Float32Array): Promise<Result<string, Error>> {
    // Native browser handles audio internally.
    this.updateHeartbeat();
    return Result.ok(this.currentTranscript);
  }

  public getLastHeartbeatTimestamp(): number {
    return this.lastHeartbeat;
  }

  protected updateHeartbeat(): void {
    this.lastHeartbeat = Date.now();
  }

  private retryWithBackoff(attempt: number): void {
    const MAX_ATTEMPTS = 3;
    const BASE_DELAY_MS = 100;

    if (attempt >= MAX_ATTEMPTS) {
      logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Max restart attempts reached, giving up');
      this.isRestarting = false;
      if (this.onEngineError) {
        this.onEngineError(TranscriptionError.network('Speech recognition restart failed after multiple attempts', false));
      }
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
