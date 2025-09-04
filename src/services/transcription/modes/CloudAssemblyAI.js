import logger from '../../../lib/logger';

const ConnectionState = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  OPEN: 'open',
  CLOSING: 'closing',
  CLOSED: 'closed',
};

export default class CloudAssemblyAI {
  constructor({ onTranscriptUpdate, onReady, getAssemblyAIToken } = {}) {
    if (typeof getAssemblyAIToken !== 'function') {
      throw new Error('CloudAssemblyAI requires a getAssemblyAIToken function.');
    }
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onReady = onReady;
    this._getAssemblyAIToken = getAssemblyAIToken;

    this.socket = null;
    this.mic = null;
    this.frameHandler = this._handleAudioFrame.bind(this);
    this.state = ConnectionState.IDLE;
    this.audioQueue = [];
    this.firstPacketSent = false;
    logger.info('[CloudAssemblyAI] Initialized.');
  }

  async startTranscription(mic) {
    if (!mic || typeof mic.onFrame !== 'function') {
      throw new Error("A mic object with an onFrame method is required.");
    }
    this.mic = mic;
    this.mic.onFrame(this.frameHandler);
    logger.info('[CloudAssemblyAI] Starting transcription and attached to mic.');

    this.state = ConnectionState.CONNECTING;

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
        this.state = ConnectionState.OPEN;
        if (this.onReady) this.onReady();
        this._processAudioQueue();
      };

      this.socket.onmessage = (event) => {
        if (this.state !== ConnectionState.OPEN) return;
        try {
          const data = JSON.parse(event.data);
          if (data.transcript) {
            if (data.turn_is_formatted && data.end_of_turn) {
              this.onTranscriptUpdate({ transcript: { final: data.transcript }, words: data.words || [] });
            } else {
              this.onTranscriptUpdate({ transcript: { partial: data.transcript } });
            }
          }
        } catch (error) {
          logger.error({ error }, 'Error processing WebSocket message');
        }
      };

      this.socket.onerror = (error) => {
        logger.error({ error }, '❌ [CloudAssemblyAI] WebSocket error:');
        this.stopTranscription();
      };

      this.socket.onclose = (event) => {
        logger.info({ code: event.code, reason: event.reason }, `🔌 [CloudAssemblyAI] WebSocket closed`);
        this._cleanupSocket();
      };

    } catch (error) {
      logger.error({ error }, '❌ [CloudAssemblyAI] Error during startup:');
      this.state = ConnectionState.CLOSED;
      throw error;
    }
  }

  _handleAudioFrame(float32Array) {
    if (this.state === ConnectionState.OPEN) {
      this._sendAudio(float32Array);
    } else if (this.state === ConnectionState.CONNECTING) {
      this.audioQueue.push(float32Array);
    }
  }

  _processAudioQueue() {
    while(this.audioQueue.length > 0) {
      const frame = this.audioQueue.shift();
      this._sendAudio(frame);
    }
  }

  _sendAudio(float32Array) {
    if (this.state !== ConnectionState.OPEN) return;
    try {
      const int16Array = new Int16Array(float32Array.length);
      for (let i = 0; i < float32Array.length; i++) {
        int16Array[i] = Math.max(-32768, Math.min(32767, float32Array[i] * 32767));
      }
      this.socket.send(int16Array.buffer);

      if (!this.firstPacketSent) {
        logger.info('[CloudAssemblyAI] Sent first audio packet.');
        this.firstPacketSent = true;
      }
    } catch (error) {
      logger.error({ error }, 'Error sending audio data');
    }
  }

  _cleanupSocket() {
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      this.socket = null;
    }
    this.state = ConnectionState.CLOSED;
  }

  async stopTranscription() {
    logger.info('[CloudAssemblyAI] Stopping transcription...');
    this.state = ConnectionState.CLOSING;

    if (this.mic) {
      this.mic.offFrame(this.frameHandler);
      this.mic = null;
    }

    this.audioQueue = [];
    this.firstPacketSent = false;

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try {
        this.socket.send(JSON.stringify({ type: "Terminate" }));
        this.socket.close(1000);
      } catch (error) {
        logger.error({ error }, 'Error while closing WebSocket');
      }
    }
    this._cleanupSocket();
  }
}
