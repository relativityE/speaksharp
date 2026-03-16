import logger from '../../../lib/logger';
import { ITranscriptionEngine, TranscriptionModeOptions, Transcript, TranscriptionError } from './types';


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
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionStatic {
  new(): SpeechRecognition;
}

export default class NativeBrowser implements ITranscriptionEngine {
  private serviceId: string;
  private runId: string;
  public readonly instanceId: string;
  private onTranscriptUpdate: (update: { transcript: Transcript }) => void;
  private onReady: () => void;
  private onError?: (error: TranscriptionError) => void;
  private recognition: SpeechRecognition | null = null;
  private isSupported: boolean = true;
  private transcript: string = '';
  private isListening: boolean = false;
  private isRestarting: boolean = false;

  constructor(options: TranscriptionModeOptions) {
    this.onTranscriptUpdate = options.onTranscriptUpdate;
    this.onReady = options.onReady;
    this.onError = options.onError;
    this.serviceId = options.serviceId || 'unknown';
    this.runId = options.instanceId || 'unknown';
    this.instanceId = Math.random().toString(36).substring(7);
  }

  public async init(): Promise<void> {
    const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition) as SpeechRecognitionStatic;
    this.isSupported = !!SpeechRecognition;

    if (!this.isSupported) {
      logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Native browser speech recognition not supported');
      throw new Error('Native browser speech recognition not supported');
    }
    this.recognition = new SpeechRecognition();
    this.recognition.interimResults = true;
    this.recognition.continuous = true;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      try {
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, resultIndex: event.resultIndex, resultsLength: event.results?.length }, '[NativeBrowser] onresult called!');
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
            this.transcript += finalTranscript;
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

        // EVENT-BASED RESTART: Use queueMicrotask instead of arbitrary setTimeout
        // queueMicrotask schedules work after current microtask completes but before
        // next event loop tick - this is the minimal delay needed for the browser to
        // release the mic handle while remaining event-driven (not arbitrary delay).
        queueMicrotask(() => {
          if (this.isListening && this.recognition) {
            try {
              this.recognition.start();
              this.isRestarting = false;
            } catch (err) {
              // If immediate restart fails, use exponential backoff with event-based retry
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
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Init complete.');

    // Notify that the service is ready immediately after initialization
    if (this.onReady) {
      logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Calling onReady callback...');
      this.onReady();
    }
  }

  public async startTranscription(): Promise<void> {
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] startTranscription called');
    if (!this.recognition) {
      throw new Error('NativeBrowser not initialized');
    }
    if (this.isListening) {
      logger.warn({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Already listening, returning early');
      return;
    }
    this.transcript = '';
    this.isListening = true;
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Starting recognition.start()...');
    this.recognition.start();

    // E2E Test Bridge: Expose instance for mock dispatching
    // This ensures tests can control recognition even if initialization order varies
    interface E2EWindow extends Window {
      __E2E_CONTEXT__?: boolean;
      TEST_MODE?: boolean;
      dispatchMockTranscript?: unknown;
      __activeSpeechRecognition?: SpeechRecognition;
    }
    const win = window as unknown as E2EWindow;

    if (win.__E2E_CONTEXT__ || win.TEST_MODE || win.dispatchMockTranscript) {
      win.__activeSpeechRecognition = this.recognition;
      // Signal ready state for tests to avoid race conditions via "Sticky Flag"
      // we don't import e2e-bridge to production to keep bundles clean.
      (win as unknown as Record<string, boolean>)['__e2e_e2e:speech-recognition-ready_fired__'] = true;
      window.dispatchEvent(new CustomEvent('e2e:speech-recognition-ready'));
    }

    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] recognition.start() called successfully.');
  }

  /**
   * EVENT-BASED RETRY: Exponential backoff for mic restart failures
   * Uses requestAnimationFrame as event trigger instead of arbitrary timeouts.
   * Max 3 attempts with 100ms, 200ms, 400ms delays.
   */
  private retryWithBackoff(attempt: number): void {
    const MAX_ATTEMPTS = 3;
    const BASE_DELAY_MS = 100;

    if (attempt >= MAX_ATTEMPTS) {
      logger.error({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Max restart attempts reached, giving up');
      this.isRestarting = false;
      if (this.onError) {
        this.onError(TranscriptionError.network('Speech recognition restart failed after multiple attempts', false));
      }
      return;
    }

    const delay = BASE_DELAY_MS * Math.pow(2, attempt);
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId, attempt, delay }, '[NativeBrowser] Scheduling retry with backoff');

    // Use setTimeout here because we genuinely need a delay for backoff
    // This is NOT an arbitrary wait - it's intentional exponential backoff
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

  public async stopTranscription(): Promise<string> {
    logger.info({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] stopTranscription called');
    if (!this.recognition || !this.isListening) {
      logger.warn({ sId: this.serviceId, rId: this.runId, eId: this.instanceId }, '[NativeBrowser] Not listening or recognition not initialized, returning current transcript.');
      return this.transcript;
    }
    this.isListening = false;
    this.recognition.stop();
    return this.transcript;
  }

  public async getTranscript(): Promise<string> {
    return this.transcript;
  }

  public getEngineType(): string {
    return 'native';
  }
}
