import logger from '../../../lib/logger';
import { ITranscriptionMode, TranscriptionModeOptions, Transcript } from './types';

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

export default class NativeBrowser implements ITranscriptionMode {
  private onTranscriptUpdate: (update: { transcript: Transcript }) => void;
  private onReady: () => void;
  private recognition: SpeechRecognition | null;
  private isSupported: boolean;
  private transcript: string;
  private isListening: boolean;

  constructor({ onTranscriptUpdate, onReady }: TranscriptionModeOptions) {
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onReady = onReady;
    this.recognition = null;
    this.isSupported = true; // Assume supported, check in init
    this.transcript = '';
    this.isListening = false;
  }

  public async init(): Promise<void> {
    logger.info('[NativeBrowser] Starting init...');
    const SpeechRecognition = (window.SpeechRecognition || window.webkitSpeechRecognition) as SpeechRecognitionStatic;
    this.isSupported = !!SpeechRecognition;
    logger.info({ isSupported: this.isSupported }, '[NativeBrowser] SpeechRecognition API supported');

    if (window.__E2E_MODE__) {
      logger.info('[E2E STUB] Bypassing NativeBrowser init for E2E test.');
      this.recognition = {
        interimResults: false,
        continuous: false,
        start: () => { },
        stop: () => { },
        onresult: null,
        onerror: null,
        onend: null,
      };
      return;
    }

    if (!this.isSupported) {
      throw new Error('Native browser speech recognition not supported');
    }
    logger.info('[NativeBrowser] Creating SpeechRecognition instance...');
    this.recognition = new SpeechRecognition();
    this.recognition.interimResults = true;
    this.recognition.continuous = true;
    logger.info('[NativeBrowser] Configuring recognition handlers...');

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      try {
        logger.info({ resultIndex: event.resultIndex, resultsLength: event.results?.length }, '[NativeBrowser] onresult called!');
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
            logger.info({ finalTranscript }, '[NativeBrowser] Final transcript received');
          } else {
            interimTranscript += event.results[i][0].transcript;
            logger.info({ interimTranscript }, '[NativeBrowser] Interim transcript received');
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
        logger.error({ error }, "Error in NativeBrowser onresult handler:");
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      try {
        logger.error({ error: event.error }, `[NativeBrowser] Speech recognition error: ${event.error}`);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          logger.error('[NativeBrowser] Microphone permission denied by user or browser settings');
        }
      } catch (error) {
        logger.error({ error }, "Error in NativeBrowser onerror handler:");
      }
    };

    this.recognition.onend = () => {
      try {
        if (this.isListening && this.recognition) {
          this.recognition.start();
        }
      } catch (error) {
        logger.error({ error }, "Error in NativeBrowser onend handler:");
      }
    };
    logger.info('[NativeBrowser] Init complete.');
  }

  public async startTranscription(): Promise<void> {
    logger.info('[NativeBrowser] startTranscription called');
    if (this.onReady) {
      logger.info('[NativeBrowser] Calling onReady callback...');
      this.onReady();
    }
    if (!this.recognition) {
      throw new Error('NativeBrowser not initialized');
    }
    if (this.isListening) {
      logger.warn('[NativeBrowser] Already listening, returning early');
      return;
    }
    this.transcript = '';
    this.isListening = true;
    logger.info('[NativeBrowser] Starting recognition.start()...');
    this.recognition.start();
    logger.info('[NativeBrowser] recognition.start() called successfully.');
  }

  public async stopTranscription(): Promise<string> {
    logger.info('[NativeBrowser] stopTranscription called');
    if (!this.recognition || !this.isListening) {
      logger.warn('[NativeBrowser] Not listening or recognition not initialized, returning current transcript.');
      return this.transcript;
    }
    this.isListening = false;
    this.recognition.stop();
    return this.transcript;
  }

  public async getTranscript(): Promise<string> {
    return this.transcript;
  }
}
