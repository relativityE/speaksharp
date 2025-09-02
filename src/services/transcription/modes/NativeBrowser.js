import logger from '../../../lib/logger';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export default class NativeBrowser {
  constructor({ onTranscriptUpdate, onReady } = {}) {
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onReady = onReady;
    this.recognition = null;
    this.isSupported = !!SpeechRecognition;
    this.transcript = '';
    this.isListening = false;
  }

  async init() {
    if (!this.isSupported) {
      throw new Error('Native browser speech recognition not supported');
    }
    this.recognition = new SpeechRecognition();
    this.recognition.interimResults = true;
    this.recognition.continuous = true;

    this.recognition.onresult = (event) => {
      try {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
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

    this.recognition.onerror = (event) => {
      try {
        logger.error({ error: event.error }, 'Speech recognition error');
        // Maybe throw a custom event or call a callback to notify the UI
      } catch (error) {
        logger.error({ error }, "Error in NativeBrowser onerror handler:");
      }
    };

    this.recognition.onend = () => {
      try {
        if (this.isListening) {
          // The service may stop listening automatically after a period of silence.
          // We can restart it to keep it listening continuously.
          this.recognition.start();
        }
      } catch (error) {
        logger.error({ error }, "Error in NativeBrowser onend handler:");
      }
    };
  }

  async startTranscription() {
    if (this.onReady) {
      this.onReady();
    }
    if (!this.recognition) {
      throw new Error('NativeBrowser not initialized');
    }
    if (this.isListening) {
      return;
    }
    this.transcript = '';
    this.isListening = true;
    this.recognition.start();
  }

  async stopTranscription() {
    if (!this.recognition || !this.isListening) {
      return this.transcript;
    }
    this.isListening = false;
    this.recognition.stop();
    return this.transcript;
  }

  async getTranscript() {
    return this.transcript;
  }
}
