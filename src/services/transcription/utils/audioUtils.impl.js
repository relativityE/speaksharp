// src/services/transcription/utils/audioUtils.js

// Lazy-load worklet URL only in browser environments
let workletUrlPromise = null;

const getWorkletUrl = () => {
  if (!workletUrlPromise) {
    // Check if we're in a browser environment with audio worklet support
    if (typeof window !== 'undefined' && window.AudioContext && AudioContext.prototype.audioWorklet) {
      workletUrlPromise = import('./audio-processor.worklet.js?url')
        .then(module => module.default)
        .catch(error => {
          console.error('Failed to load audio worklet:', error);
          return null;
        });
    } else {
      // Node.js/test environment - return rejected promise
      workletUrlPromise = Promise.reject(new Error('Audio worklets not supported in this environment'));
    }
  }
  return workletUrlPromise;
};

export async function createMicStreamImpl({ sampleRate = 16000, frameSize = 1024 } = {}) {
  // Early environment check
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    throw new Error('Media devices not available in this environment');
  }

  const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });

  // Load worklet URL dynamically
  const workletUrl = await getWorkletUrl();
  if (!workletUrl) {
    throw new Error('Audio worklet failed to load');
  }

  await audioCtx.audioWorklet.addModule(workletUrl);

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
      try { source.disconnect(); node.disconnect(); } catch (e) { /* best effort */ }
      audioCtx.close().catch(() => { /* best effort */ });
      mediaStream.getTracks().forEach(t => t.stop());
    }
  };
}
