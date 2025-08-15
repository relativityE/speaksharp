// src/services/transcription/modes/CloudAssemblyAI.js
export default class CloudAssemblyAI {
  constructor({ apiKey = import.meta.env.VITE_ASSEMBLYAI_API_KEY, performanceWatcher, onUpdate } = {}) {
    this.apiKey = apiKey;
    this.ws = null;
    this.transcript = '';
    this.performanceWatcher = performanceWatcher;
    this.onUpdate = onUpdate;
    this._frameCount = 0;
    this._t0 = 0;
  }

  async init() {
    if (!this.apiKey) throw new Error('Missing VITE_ASSEMBLYAI_API_KEY');
  }

  async startTranscription(mic) {
    const url = import.meta.env.VITE_ASSEMBLYAI_WEBSOCKET_URL || `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000`;
    this.ws = new WebSocket(url, []);
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ event: 'authenticated', token: this.apiKey }));
      this._frameCount = 0;
      this._t0 = performance.now();
    };

    this.ws.onmessage = (m) => {
      try {
        const msg = JSON.parse(m.data);
        if (msg.text) {
          this.transcript = msg.text;
          if (this.onUpdate) {
            this.onUpdate({
              transcript: msg.text,
              isFinal: msg.message_type === 'FinalTranscript'
            });
          }
        }
      } catch {}
    };

    this.ws.onerror = (e) => console.error('AssemblyAI WS error', e);
    this.ws.onclose = () => {};

    const onFrame = (f32) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      // Convert float32 PCM [-1,1] → 16-bit PCM → base64
      const b16 = floatTo16BitPCM(f32);
      const b64 = base64Encode(b16);
      this.ws.send(JSON.stringify({ audio_data: b64 }));

      // PERF
      this._frameCount++;
      if (this._frameCount % 10 === 0 && this.performanceWatcher) {
        const elapsedMs = performance.now() - this._t0;
        const audioMs = (this._frameCount * 1024) / 16000 * 1000;
        const rtFactor = elapsedMs / audioMs; // for cloud this should stay ~<1 (client-side queueing)
        this.performanceWatcher({ provider: 'cloud', rtFactor, elapsedMs, audioMs });
      }
    };

    mic.onFrame(onFrame);
    this._stop = () => mic.offFrame(onFrame);
  }

  async stopTranscription() {
    if (this._stop) this._stop();
    this._stop = null;
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ terminate_session: true }));
        this.ws.close();
      }
    } catch {}
    return this.transcript;
  }

  async getTranscript() {
    return this.transcript;
  }
}

/* helpers */
function floatTo16BitPCM(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
function base64Encode(int16) {
  // Convert Int16Array → Uint8Array → base64
  const u8 = new Uint8Array(int16.buffer);
  let bin = '';
  for (let i = 0; i < u8.byteLength; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}
