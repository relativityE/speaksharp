// src/services/transcription/utils/audioUtils.js
const WORKLET_URL = new URL('./audio-processor.worklet.js', import.meta.url);

export async function createMicStream({ sampleRate = 16000, frameSize = 1024 } = {}) {
  const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  await audioCtx.audioWorklet.addModule(WORKLET_URL);

  const source = audioCtx.createMediaStreamSource(mediaStream);
  const node = new AudioWorkletNode(audioCtx, 'pcm-downsampler', {
    processorOptions: { targetSampleRate: sampleRate, frameSize }
  });

  const listeners = new Set();
  node.port.onmessage = (e) => {
    // e.data is Float32Array at 16kHz mono
    for (const cb of listeners) cb(e.data);
  };

  source.connect(node).connect(audioCtx.destination); // destination keeps graph alive (muted)
  audioCtx.destination.volume = 0; // ensure silence

  return {
    sampleRate,
    onFrame: (cb) => listeners.add(cb),
    offFrame: (cb) => listeners.delete(cb),
    stop: () => {
      try { source.disconnect(); node.disconnect(); } catch {}
      audioCtx.close().catch(() => {});
      mediaStream.getTracks().forEach(t => t.stop());
    }
  };
}
