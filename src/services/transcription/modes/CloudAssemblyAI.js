export default class CloudAssemblyAI {
  constructor({ onTranscriptUpdate, onReady, getAssemblyAIToken } = {}) {
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onReady = onReady;
    this._getAssemblyAIToken = getAssemblyAIToken;
    this.socket = null;
    this.mediaRecorder = null;
  }

  async init() {
    if (typeof this._getAssemblyAIToken !== 'function') {
      throw new Error('CloudAssemblyAI requires a getAssemblyAIToken function.');
    }
  }

  async startTranscription(mic) {
    if (!mic || !mic._mediaStream) {
      throw new Error("A mediaStream is required to start transcription.");
    }

    try {
      const token = await this._getAssemblyAIToken();
      if (!token) {
        throw new Error("Failed to retrieve AssemblyAI token.");
      }

      // Use the new v3 endpoint for the Universal-Streaming model.
      const socket = new WebSocket(
        `wss://streaming.assemblyai.com/v3/ws?token=${token}`
      );
      this.socket = socket;

      socket.onopen = () => {
        console.log('✅ AssemblyAI WebSocket connected');
        if (this.onReady) this.onReady();
        this._startAudioCapture(mic._mediaStream);
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.message_type === 'FinalTranscript' && data.text) {
          this.onTranscriptUpdate({ transcript: { final: data.text }, words: data.words });
        } else if (data.message_type === 'PartialTranscript' && data.text) {
          this.onTranscriptUpdate({ transcript: { partial: data.text } });
        }
      };

      socket.onerror = (error) => {
        console.error('❌ AssemblyAI WebSocket error:', error);
        this.stopTranscription();
      };

      socket.onclose = (event) => {
        console.log('🔌 AssemblyAI WebSocket closed:', event.code, event.reason);
        this.socket = null;
      };

    } catch (error) {
      console.error('❌ Error starting cloud transcription:', error);
      throw error;
    }
  }

  _startAudioCapture(stream) {
    const mediaRecorder = new MediaRecorder(stream);
    this.mediaRecorder = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && this.socket?.readyState === WebSocket.OPEN) {
        const reader = new FileReader();
        reader.onload = () => {
          const base64Audio = reader.result.split(',')[1];
          this.socket.send(JSON.stringify({ audio_data: base64Audio }));
        };
        reader.readAsDataURL(event.data);
      }
    };

    // Send audio data in chunks
    mediaRecorder.start(250);
    console.log('🎙️ Cloud audio capture started');
  }

  async stopTranscription() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      this.mediaRecorder = null;
    }
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      // Send a termination message before closing
      this.socket.send(JSON.stringify({ terminate_session: true }));
      this.socket.close(1000);
      this.socket = null;
    }
  }
}
