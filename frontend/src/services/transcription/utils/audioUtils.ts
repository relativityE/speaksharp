import { MicStream, MicStreamOptions } from './types';

export async function createMicStream(options: MicStreamOptions = {}): Promise<MicStream> {
  // Dynamic import the actual implementation only when called
  // Dynamic import the actual implementation only when called
  const { createMicStreamImpl } = await import('./audioUtils.impl');
  return createMicStreamImpl(options);
}
