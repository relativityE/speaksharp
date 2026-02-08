export type MicState = 'idle' | 'initializing' | 'ready' | 'recording' | 'error';

export interface MicStreamOptions {
  sampleRate?: number;
  frameSize?: number;
}

export interface MicStream {
  state: MicState;
  sampleRate: number;
  onFrame: (callback: (frame: Float32Array) => void) => void;
  offFrame: (callback: (frame: Float32Array) => void) => void;
  stop: () => void;
  close: () => void;
  _mediaStream: MediaStream;
}
