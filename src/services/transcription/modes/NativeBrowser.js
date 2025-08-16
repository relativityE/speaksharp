const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export default class NativeBrowser {
  constructor({ onTranscriptUpdate } = {}) {
    this.onTranscriptUpdate = onTranscriptUpdate;
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
    };

    this.recognition.onerror = (event) => {
      console.error('Speech recognition error', event.error);
    };

    this.recognition.onend = () => {
      if (this.isListening) {
        // The service may stop listening automatically after a period of silence.
        // We can restart it to keep it listening continuously.
        this.recognition.start();
      }
    };
  }

  async startTranscription() {
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
