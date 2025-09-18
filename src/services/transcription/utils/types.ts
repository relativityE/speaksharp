export interface MicStreamOptions {
  sampleRate?: number;
  frameSize?: number;
}

export interface MicStream {
  sampleRate: number;
  onFrame: (callback: (frame: Float32Array) => void) => void;
  offFrame: (callback: (frame: Float32Array) => void) => void;
  stop: () => void;
  _mediaStream: MediaStream;
}
