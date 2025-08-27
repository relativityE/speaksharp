import { AssemblyAI } from 'assemblyai';

export default class CloudAssemblyAI {
  constructor({ onTranscriptUpdate, onReady, getAssemblyAIToken } = {}) {
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onReady = onReady;
    this._getAssemblyAIToken = getAssemblyAIToken; // Injected dependency
    this.transcriber = null;
    this._stopMicListener = null;
  }

  async init() {
    if (typeof this._getAssemblyAIToken !== 'function') {
      throw new Error('CloudAssemblyAI requires a getAssemblyAIToken function.');
    }
  }

  async startTranscription(mic) {
    try {
      const assemblyAIToken = await this._getAssemblyAIToken();
      if (!assemblyAIToken) {
        throw new Error("Failed to retrieve AssemblyAI token.");
      }

      this.transcriber = new AssemblyAI.StreamingTranscriber({
        token: assemblyAIToken,
        sampleRate: 16000,
      });

      this.transcriber.on('open', ({ sessionId }) => {
        console.log(`AssemblyAI session opened with ID: ${sessionId}`);
        if (this.onReady) this.onReady();

        const onFrame = (f32) => {
          if (this.transcriber) {
            this.transcriber.sendAudio(f32);
          }
        };
        mic.onFrame(onFrame);
        this._stopMicListener = () => mic.offFrame(onFrame);
      });

      this.transcriber.on('error', (error) => {
        console.error('AssemblyAI error:', error);
      });

      this.transcriber.on('close', (code, reason) => {
        console.log('AssemblyAI session closed:', code, reason);
        this.transcriber = null;
      });

      this.transcriber.on('transcript.partial', (p) => {
        if (p.text && this.onTranscriptUpdate) this.onTranscriptUpdate({ transcript: { partial: p.text } });
      });
      this.transcriber.on('transcript.final', (f) => {
        if (f.text && this.onTranscriptUpdate) this.onTranscriptUpdate({ transcript: { final: f.text }, words: f.words });
      });

      await this.transcriber.connect();

    } catch (error) {
      console.error('Failed to start transcription:', error);
      throw error;
    }
  }

  async stopTranscription() {
    if (this._stopMicListener) {
      this._stopMicListener();
      this._stopMicListener = null;
    }

    if (this.transcriber) {
      await this.transcriber.close();
      this.transcriber = null;
    }
  }
}
