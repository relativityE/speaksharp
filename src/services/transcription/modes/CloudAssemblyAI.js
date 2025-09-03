import logger from '../../../lib/logger';

export default class CloudAssemblyAI {
  constructor({ onTranscriptUpdate, onReady, getAssemblyAIToken } = {}) {
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onReady = onReady;
    this._getAssemblyAIToken = getAssemblyAIToken;
    this.socket = null;
    this.mic = null;
    this.frameHandler = this._handleAudioFrame.bind(this);
    this.firstPacketSent = false;
  }

  async init() {
    if (typeof this._getAssemblyAIToken !== 'function') {
      throw new Error('CloudAssemblyAI requires a getAssemblyAIToken function.');
    }
    logger.info('[CloudAssemblyAI] Initialized.');
  }

  async startTranscription(mic) {
    if (!mic || typeof mic.onFrame !== 'function') {
      throw new Error("A mic object with an onFrame method is required.");
    }
    this.mic = mic;
    logger.info('[CloudAssemblyAI] Starting transcription...');

    try {
      logger.info('[CloudAssemblyAI] Requesting AssemblyAI token...');
      const token = await this._getAssemblyAIToken();
      if (!token) {
        throw new Error("Failed to retrieve AssemblyAI token.");
      }
      logger.info('[CloudAssemblyAI] Token received.');

      const url = `wss://streaming.assemblyai.com/v3/ws?sample_rate=${mic.sampleRate}&token=${token}&format_turns=true`;
      this.socket = new WebSocket(url);

      this.socket.onopen = () => {
        logger.info('✅ [CloudAssemblyAI] WebSocket connected to AssemblyAI.');
        if (this.onReady) this.onReady();
        // Start sending audio data
        this.mic.onFrame(this.frameHandler);
      };

      this.socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        logger.info({ data }, '[CloudAssemblyAI] Received message:');

        // The V3 API sends transcript data without a 'message_type' field.
        // We determine if it's partial or final based on 'end_of_turn' and 'turn_is_formatted'.
        if (data.transcript) {
          if (data.turn_is_formatted && data.end_of_turn) {
            // This is the final, polished transcript for a turn.
            this.onTranscriptUpdate({ transcript: { final: data.transcript }, words: data.words || [] });
          } else {
            // This is a partial, real-time transcript.
            this.onTranscriptUpdate({ transcript: { partial: data.transcript } });
          }
        }
      };

      this.socket.onerror = (error) => {
        logger.error({ error }, '❌ [CloudAssemblyAI] WebSocket error:');
        this.stopTranscription(); // Clean up on error
      };

      this.socket.onclose = (event) => {
        logger.info({ code: event.code, reason: event.reason }, `🔌 [CloudAssemblyAI] WebSocket closed`);
        this.socket = null;
        // Ensure the mic listener is removed
        if (this.mic) {
          this.mic.offFrame(this.frameHandler);
        }
      };

    } catch (error) {
      logger.error({ error }, '❌ [CloudAssemblyAI] Error starting cloud transcription:');
      throw error;
    }
  }

  _handleAudioFrame(float32Array) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    // Convert Float32Array to Int16Array
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      int16Array[i] = Math.max(-32768, Math.min(32767, float32Array[i] * 32767));
    }

    // Send the raw audio data as a binary message
    this.socket.send(int16Array.buffer);

    if (!this.firstPacketSent) {
      logger.info('[CloudAssemblyAI] Sent first audio packet.');
      this.firstPacketSent = true;
    }
  }

  async stopTranscription() {
    logger.info('[CloudAssemblyAI] Stopping transcription...');
    if (this.mic) {
      this.mic.offFrame(this.frameHandler);
      logger.info('[CloudAssemblyAI] Mic frame handler removed.');
      this.mic = null;
    }
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      logger.info('[CloudAssemblyAI] Sending termination message.');
      this.socket.send(JSON.stringify({ type: "Terminate" }));
      this.socket.close(1000);
      this.socket = null;
    } else {
      logger.info('[CloudAssemblyAI] No active socket to stop.');
    }
  }
}
