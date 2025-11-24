import logger from '../../../lib/logger';
import { MicStream, MicStreamOptions } from './types';

// This file contains the actual implementation for creating a microphone stream
// and is dynamically imported by the 'safe' wrapper file (audioUtils.ts).

// Lazy-load worklet URL only in browser environments
let workletUrlPromise: Promise<string | null> | null = null;

const getWorkletUrl = (audioContext: AudioContext): Promise<string | null> => {
  if (!workletUrlPromise) {
    // Check if we're in a browser environment with audio worklet support
    if (typeof window !== 'undefined' && audioContext && audioContext.audioWorklet) {
      workletUrlPromise = import('./audio-processor.worklet.ts?url')
        .then(module => module.default)
        .catch(error => {
          logger.error({ error }, 'Failed to load audio worklet:');
          return null;
        });
    } else {
      // Node.js/test environment - return rejected promise
      workletUrlPromise = Promise.reject(new Error('Audio worklets not supported in this environment'));
    }
  }
  return workletUrlPromise;
};

interface WindowWithwebkitAudioContext extends Window {
    webkitAudioContext: typeof AudioContext;
}

export async function createMicStreamImpl(
  { sampleRate = 16000, frameSize = 1024 }: MicStreamOptions = {}
): Promise<MicStream> {
  // In test mode, return a mock stream to avoid hardware errors in CI
  if (window.TEST_MODE) {
    logger.info('Mocking microphone stream for TEST_MODE');
    return {
      sampleRate,
      onFrame: () => {},
      offFrame: () => {},
      stop: () => {},
      close: () => {},
      _mediaStream: new MediaStream(),
    };
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
  gainNode.gain.value = 0; // Mute the aoutput to prevent feedback
  source.connect(node).connect(gainNode).connect(audioCtx.destination); // destination keeps graph alive

  const stopAndClose = () => {
    try {
      source.disconnect();
      node.disconnect();
    } catch { /* best effort */ }
    audioCtx.close().catch(() => { /* best effort */ });
    mediaStream.getTracks().forEach(t => t.stop());
  };

  return {
    sampleRate,
    onFrame: (cb) => listeners.add(cb),
    offFrame: (cb) => listeners.delete(cb),
    stop: stopAndClose,
    close: stopAndClose,
    _mediaStream: mediaStream,
  };
}
