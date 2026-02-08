import logger from '../../../lib/logger';
import { MicStream, MicStreamOptions } from './types';
import { TestFlags } from '../../../config/TestFlags';

// This file contains the actual implementation for creating a microphone stream
// and is dynamically imported by the 'safe' wrapper file (audioUtils.ts).

// Return worklet URL from public/ directory
// AudioWorklets MUST be loaded from real HTTP URLs, not bundled data URLs
// This is a platform constraint - Vite's ?url inlining breaks AudioWorklet.addModule()
const getWorkletUrl = (audioContext: AudioContext): Promise<string | null> => {
  // Check if we're in a browser environment with audio worklet support
  if (typeof window !== 'undefined' && audioContext && audioContext.audioWorklet) {
    // Return path to static worklet in public/ directory
    return Promise.resolve('/audio/audio-processor.worklet.js');
  } else {
    // Node.js/test environment - return rejected promise
    return Promise.reject(new Error('Audio worklets not supported in this environment'));
  }
};

interface WindowWithwebkitAudioContext extends Window {
  webkitAudioContext: typeof AudioContext;
  micStream?: MicStream;
}

export async function createMicStreamImpl(
  { sampleRate = 16000, frameSize = 1024 }: MicStreamOptions = {}
): Promise<MicStream> {
  // In test mode, return a mock stream to avoid hardware errors in CI.
  // CRITICAL: Bypass mock if we are explicitly running driver-dependent tests.
  if (TestFlags.IS_TEST_MODE && !TestFlags.USE_REAL_TRANSCRIPTION) {
    logger.info('Mocking microphone stream for TEST_ENVIRONMENT');
    const mockStream: MicStream = {
      state: 'ready',
      sampleRate,
      onFrame: () => { },
      offFrame: () => { },
      stop: () => { },
      close: () => { },
      _mediaStream: new MediaStream(),
    };

    // Expose for E2E synchronization
    if (TestFlags.DEBUG_ENABLED && typeof window !== 'undefined') {
      (window as unknown as WindowWithwebkitAudioContext).micStream = mockStream;
    }

    return mockStream;
  }

  // Early environment check
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    throw new Error('Media devices not available in this environment');
  }

  const audioCtx = new (window.AudioContext || (window as unknown as WindowWithwebkitAudioContext).webkitAudioContext)({ sampleRate: 48000 });
  const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // Load worklet URL dynamically, passing the audio context instance for the check.
  const workletUrl = await getWorkletUrl(audioCtx);
  if (!workletUrl) {
    throw new Error('Audio worklet failed to load');
  }

  // Ensure context is running (required in many browsers)
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  await audioCtx.audioWorklet.addModule(workletUrl);

  const source = audioCtx.createMediaStreamSource(mediaStream);
  const node = new AudioWorkletNode(audioCtx, 'pcm-downsampler', {
    processorOptions: { targetSampleRate: sampleRate, frameSize }
  });

  const listeners = new Set<(frame: Float32Array) => void>();
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    // e.data is Float32Array at 16kHz mono
    for (const cb of listeners) cb(e.data);
  };

  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 0; // Mute the output to prevent feedback
  source.connect(node).connect(gainNode).connect(audioCtx.destination); // destination keeps graph alive

  const stopAndClose = () => {
    try {
      source.disconnect();
      node.disconnect();
    } catch { /* best effort */ }
    audioCtx.close().catch(() => { /* best effort */ });
    mediaStream.getTracks().forEach(t => t.stop());
  };

  const stream: MicStream = {
    state: 'ready',
    sampleRate,
    onFrame: (cb: (frame: Float32Array) => void) => listeners.add(cb),
    offFrame: (cb: (frame: Float32Array) => void) => listeners.delete(cb),
    stop: stopAndClose,
    close: stopAndClose,
    _mediaStream: mediaStream,
  };

  // Expose for E2E synchronization
  if (TestFlags.DEBUG_ENABLED && typeof window !== 'undefined') {
    (window as unknown as WindowWithwebkitAudioContext).micStream = stream;
    console.log('[MicStream] 🎤 Ready and exposed to window.micStream');
  }

  return stream;
}
